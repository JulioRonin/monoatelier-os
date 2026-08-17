
import { supabase } from './supabaseClient';
import { Project, Client, Quote, ProjectStatus, PriorityLevel, PhaseEnum, User, ForgeModel, ForgeJob, Service, ServiceVariable, TipoVariante, FacturaExterna, RepPago } from '../types';
import type { CfdiExterno } from './cfdi';

// --- MAPPING HELPERS ---

const mapFacturaExterna = (d: any): FacturaExterna => ({
    id: d.id,
    uuid: d.uuid,
    serie: d.serie || '',
    folio: d.folio || '',
    fecha: d.fecha,
    emisorRfc: d.emisor_rfc,
    emisorNombre: d.emisor_nombre || '',
    receptorRfc: d.receptor_rfc,
    receptorNombre: d.receptor_nombre || '',
    receptorRegimen: d.receptor_regimen,
    receptorCp: d.receptor_cp,
    usoCfdi: d.uso_cfdi || '',
    moneda: d.moneda || 'MXN',
    tipoCambio: Number(d.tipo_cambio ?? 1),
    metodoPago: d.metodo_pago,
    formaPago: d.forma_pago || '',
    subtotal: Number(d.subtotal ?? 0),
    total: Number(d.total ?? 0),
    impuestos: d.impuestos || [],
    createdAt: d.created_at,
});

const mapRepPago = (d: any): RepPago => ({
    id: d.id,
    facturaUuid: d.factura_uuid,
    facturaOrigen: d.factura_origen,
    facturaFolio: d.factura_folio || undefined,
    repUuid: d.rep_uuid || undefined,
    repFacturapiId: d.rep_facturapi_id || undefined,
    repSerie: d.rep_serie || undefined,
    repFolio: d.rep_folio ?? undefined,
    fechaPago: d.fecha_pago,
    formaPago: d.forma_pago,
    moneda: d.moneda || 'MXN',
    tipoCambio: Number(d.tipo_cambio ?? 1),
    monto: Number(d.monto ?? 0),
    parcialidad: Number(d.parcialidad ?? 1),
    saldoAnterior: Number(d.saldo_anterior ?? 0),
    saldoInsoluto: Number(d.saldo_insoluto ?? 0),
});

const mapClient = (data: any): Client => ({
    id: data.id,
    fullName: data.full_name || 'Unknown',
    email: data.email || '',
    phone: data.phone || '',
    avatarUrl: data.avatar_url || '',
    rfc: data.rfc || '',
    fiscalName: data.fiscal_name || '',
    fiscalRegime: data.fiscal_regime || '',
    postalCode: data.postal_code || ''
});

const mapProject = (data: any): Project => {
    return {
        id: data.id,
        clientId: data.client_id,
        name: data.name,
        status: data.status,
        budget: data.budget,
        liveCost: data.live_cost || 0,
        downpayment: data.downpayment || 0,
        startDate: data.start_date,
        dueDate: data.due_date,
        progress: data.progress,
        priority: data.priority,
        phase: data.phase,
        docsUrl: data.docs_url || [],
        team: data.team || [],
        projectOverview: data.project_overview,
        responsibleId: data.responsible_id
    };
};

const mapService = (d: any): Service => ({
    id: d.id,
    sku: d.sku ?? null,
    name: d.name,
    category: d.category || '',
    description: d.description || '',
    basePrice: Number(d.base_price) || 0,
    cost: d.cost == null ? null : Number(d.cost),
    units: d.units || '',
    active: d.active !== false,
    priceUpdatedAt: d.price_updated_at ?? null,
    notes: d.notes ?? null,
});

const mapServiceVariable = (d: any): ServiceVariable => ({
    id: d.id,
    serviceId: d.service_id,
    name: d.name,
    // sin la migración la columna no existe: el default conserva el
    // comportamiento anterior en vez de romper la página
    kind: (d.kind as TipoVariante) || 'sustitucion',
    price: d.price == null ? null : Number(d.price),
    cost: d.cost == null ? null : Number(d.cost),
    units: d.units ?? null,
    active: d.active !== false,
    sortOrder: Number(d.sort_order) || 0,
});

const mapForgeModel = (data: any): ForgeModel => ({
    id: data.id,
    name: data.name,
    description: data.description || '',
    projectId: data.project_id,
    projectJson: data.project_json,
    glbUrl: data.glb_url,
    usdzUrl: data.usdz_url,
    documentos: data.documentos || null,
    costosPath: data.costos_path || null,
    status: data.status || 'draft',
    createdAt: data.created_at
});

const mapForgeJob = (data: any): ForgeJob => ({
    id: data.id,
    prompt: data.prompt,
    baseModelId: data.base_model_id,
    imagenes: data.imagenes || [],
    status: data.status,
    resultModelId: data.result_model_id,
    log: data.log,
    error: data.error,
    createdAt: data.created_at,
    updatedAt: data.updated_at
});

// --- API METHODS ---

export const api = {
    // CLIENTS
    async getClients() {
        if (!supabase) {
            console.warn("Supabase not configured. Return empty array.");
            return [];
        }
        // Try to fetch from 'Clientes' (Capitalized) as seen in screenshot
        const { data, error } = await supabase
            .from('clients')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching clients:', error);
            throw error;
        }
        return (data || []).map(mapClient);
    },

    async createClient(client: Omit<Client, 'id' | 'avatarUrl'>) {
        if (!supabase) throw new Error("Supabase not configured");

        const { data, error } = await supabase
            .from('clients')
            .insert([{
                full_name: client.fullName,
                email: client.email,
                phone: client.phone,
                rfc: client.rfc,
                fiscal_name: client.fiscalName,
                fiscal_regime: client.fiscalRegime,
                postal_code: client.postalCode
            }])
            .select()
            .single();

        if (error) throw error;
        return mapClient(data);
    },

    async updateClient(id: string, updates: Partial<Client>) {
        if (!supabase) throw new Error("Supabase not configured");
        const { error } = await supabase
            .from('clients')
            .update({
                full_name: updates.fullName,
                email: updates.email,
                phone: updates.phone,
                rfc: updates.rfc,
                fiscal_name: updates.fiscalName,
                fiscal_regime: updates.fiscalRegime,
                postal_code: updates.postalCode
            })
            .eq('id', id);

        if (error) throw error;
    },

    async deleteClient(id: string) {
        if (!supabase) throw new Error("Supabase not configured");
        const { error } = await supabase
            .from('clients')
            .delete()
            .eq('id', id);

        if (error) throw error;
    },

    // PROJECTS
    async getProjects() {
        if (!supabase) {
            console.warn("Supabase not configured. Return empty array.");
            return [];
        }
        const { data, error } = await supabase
            .from('projects')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching projects:', error);
            throw error;
        }
        return (data || []).map(mapProject);
    },

    async getProjectById(id: string) {
        if (!supabase) throw new Error("Supabase not configured");
        const { data, error } = await supabase
            .from('projects')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        // Use the same mapper or duplicate for now if mapProject isn't exported or reusable easily
        // But mapProject CALL is visible in line 123 of previous view!
        // Step 2193 shows:
        // 123:         return mapProject(data);
        // So I just need to update `mapProject` IF it exists as a separate function, OR update the inline mapping if `getProjects` used inline mapping.
        // Wait, `getProjects` used inline mapping in Step 2187.
        // But `getProjectById` calls `mapProject`.
        // I need to find `mapProject` definition.
        // It's likely at the bottom or top of the file.
        // Let's find `const mapProject =` or `function mapProject`.
        return mapProject(data);
    },


    async createProject(project: Partial<Project>) {
        if (!supabase) throw new Error("Supabase not configured");

        const { data, error } = await supabase
            .from('projects')
            .insert([{
                name: project.name,
                client_id: project.clientId,
                status: project.status,
                budget: project.budget,
                live_cost: project.liveCost,
                start_date: project.startDate,
                progress: project.progress,
                phase: project.phase,
                project_overview: project.projectOverview,
                team: project.team
            }])
            .select()
            .single();

        if (error) throw error;
        return mapProject(data);
    },

    async updateProject(id: string, updates: Partial<Project>) {
        if (!supabase) throw new Error("Supabase not configured");

        // Map frontend camelCase to backend snake_case
        const dbUpdates: any = {};
        if (updates.name) dbUpdates.name = updates.name;
        if (updates.status) dbUpdates.status = updates.status;
        if (updates.budget !== undefined) dbUpdates.budget = updates.budget;
        if (updates.liveCost !== undefined) dbUpdates.live_cost = updates.liveCost;
        if (updates.liveCost !== undefined) dbUpdates.live_cost = updates.liveCost;
        if (updates.startDate) dbUpdates.start_date = updates.startDate;
        if (updates.startDate) dbUpdates.start_date = updates.startDate;
        if (updates.dueDate) dbUpdates.due_date = updates.dueDate;
        if (updates.progress !== undefined) dbUpdates.progress = updates.progress;
        if (updates.phase) dbUpdates.phase = updates.phase;
        if (updates.phase) dbUpdates.phase = updates.phase;
        if (updates.docsUrl) dbUpdates.docs_url = updates.docsUrl;
        if (updates.team) dbUpdates.team = updates.team;
        if (updates.responsibleId !== undefined) dbUpdates.responsible_id = updates.responsibleId || null;

        const { error } = await supabase
            .from('projects')
            .update(dbUpdates)
            .eq('id', id);

        if (error) throw error;
    },

    // TEAM
    async getTeamMembers() {
        if (!supabase) return [];
        const { data, error } = await supabase
            .from('team_members')
            .select('*')
            .order('full_name');

        if (error) {
            console.error('Error fetching team:', error);
            return [];
        }
        return (data || []).map((m: any) => ({
            id: m.id,
            fullName: m.full_name || '',
            role: m.role || '',
            category: m.category || 'Technical',
            permissionLevel: m.permission_level || 'Lvl 1',
            status: m.status || 'Active',
            avatarUrl: m.avatar_url || null,
            email: m.email || ''
        }));
    },

    async addTeamMember(member: any) {
        if (!supabase) return;
        const { error } = await supabase.from('team_members').insert([{
            full_name: member.fullName,
            role: member.role,
            category: member.category,
            permission_level: member.permissionLevel,
            status: member.status,
            email: member.email,
            avatar_url: member.avatarUrl
        }]);
        if (error) throw error;
    },

    async updateTeamMember(id: string, updates: any) {
        if (!supabase) return;
        const dbUpdates: any = {};
        if (updates.fullName) dbUpdates.full_name = updates.fullName;
        if (updates.role) dbUpdates.role = updates.role;
        if (updates.category) dbUpdates.category = updates.category;
        if (updates.permissionLevel) dbUpdates.permission_level = updates.permissionLevel;
        if (updates.status) dbUpdates.status = updates.status;
        if (updates.email) dbUpdates.email = updates.email;

        const { error } = await supabase.from('team_members').update(dbUpdates).eq('id', id);
        if (error) throw error;
    },

    async deleteTeamMember(id: string) {
        if (!supabase) return;
        const { error } = await supabase.from('team_members').delete().eq('id', id);
        if (error) throw error;
    },

    // QUOTES
    async getQuotes() {
        if (!supabase) {
            console.warn("Supabase not configured. Return empty array.");
            return [];
        }
        const { data, error } = await supabase
            .from('quotes')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching quotes:', error);
            throw error;
        }

        // Parse items if they are stored as JSON string, or keep as is if JSONB
        return (data || []).map((q: any) => ({
            ...q,
            projectName: q.project_name,
            clientName: q.client_name,
            totalAmount: q.total_amount || 0,
            deliveryTime: q.delivery_time,
            // Parse items if string (should be auto-parsed by JS client if jsonb, but safe to check)
            items: (typeof q.items === 'string' ? JSON.parse(q.items) : (q.items || [])).map((item: any) => ({
                ...item,
                unitPrice: item.unitPrice || 0,
                quantity: item.quantity || 1
            }))
        })) as Quote[];
    },

    async createQuote(quote: Quote) {
        if (!supabase) throw new Error("Supabase not configured");
        // Strip ID if it's a placeholder, or let DB handle UUID
        const { data, error } = await supabase
            .from('quotes')
            .insert([{
                project_name: quote.projectName,
                client_name: quote.clientName,
                date: quote.date,
                delivery_time: quote.deliveryTime,
                items: quote.items,
                notes: quote.notes,
                status: quote.status,
                total_amount: quote.totalAmount
            }])
            .select()
            .single();

        if (error) throw error;
        if (error) throw error;
        return data;
    },

    async updateQuote(id: string, quote: Partial<Quote>) {
        if (!supabase) throw new Error("Supabase not configured");

        const updates: any = {};
        if (quote.projectName) updates.project_name = quote.projectName;
        if (quote.clientName) updates.client_name = quote.clientName;
        if (quote.date) updates.date = quote.date;
        if (quote.deliveryTime) updates.delivery_time = quote.deliveryTime;
        if (quote.items) updates.items = quote.items; // JSON/JSONB
        if (quote.notes) updates.notes = quote.notes;
        if (quote.totalAmount !== undefined) updates.total_amount = quote.totalAmount;
        if (quote.status) updates.status = quote.status;

        const { error } = await supabase
            .from('quotes')
            .update(updates)
            .eq('id', id);

        if (error) throw error;
    },

    async updateQuoteStatus(id: string, status: string) {
        if (!supabase) throw new Error("Supabase not configured");
        const { error } = await supabase
            .from('quotes')
            .update({ status })
            .eq('id', id);

        if (error) throw error;
    },

    async deleteQuote(id: string) {
        if (!supabase) throw new Error("Supabase not configured");
        const { error } = await supabase
            .from('quotes')
            .delete()
            .eq('id', id);

        if (error) throw error;
    },

    // PAYMENTS
    async getAllPayments() {
        if (!supabase) return [];
        const { data, error } = await supabase
            .from('payments')
            .select('*');

        if (error) {
            console.error('Error fetching all payments:', error);
            return [];
        }

        return (data || []).map((p: any) => ({
            id: p.id,
            projectId: p.project_id,
            amount: p.amount,
            date: p.date,
            method: p.method
        }));
    },

    async getPayments(projectId: string) {
        if (!supabase) throw new Error("Supabase not configured");
        const { data, error } = await supabase
            .from('payments')
            .select('*')
            .eq('project_id', projectId)
            .order('date', { ascending: false });

        if (error) throw error;

        return (data || []).map((p: any) => ({
            id: p.id,
            projectId: p.project_id,
            amount: p.amount,
            date: p.date,
            notes: p.notes,
            method: p.method
        }));
    },

    async addPayment(payment: { projectId: string, amount: number, date: string, notes: string, method: string }) {
        if (!supabase) throw new Error("Supabase not configured");
        const { data, error } = await supabase
            .from('payments')
            .insert([{
                project_id: payment.projectId,
                amount: payment.amount,
                date: payment.date,
                notes: payment.notes,
                method: payment.method
            }])
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async updatePayment(id: string, updates: { amount?: number, date?: string, notes?: string, method?: string }) {
        if (!supabase) throw new Error("Supabase not configured");
        const dbUpdates: any = {};
        if (updates.amount !== undefined) dbUpdates.amount = updates.amount;
        if (updates.date) dbUpdates.date = updates.date;
        if (updates.notes) dbUpdates.notes = updates.notes;
        if (updates.method) dbUpdates.method = updates.method;

        const { error } = await supabase
            .from('payments')
            .update(dbUpdates)
            .eq('id', id);

        if (error) throw error;
    },

    async deletePayment(id: string) {
        if (!supabase) throw new Error("Supabase not configured");
        const { error } = await supabase
            .from('payments')
            .delete()
            .eq('id', id);

        if (error) throw error;
    },

    // MASTER LIST — servicios, componentes y precios
    async getServices(incluirInactivos = false): Promise<Service[]> {
        if (!supabase) return [];
        let q = supabase.from('services').select('*').order('name');
        if (!incluirInactivos) q = q.or('active.is.null,active.eq.true');
        const { data, error } = await q;
        if (error) {
            console.error('Error fetching services:', error);
            return [];
        }
        return (data || []).map(mapService);
    },

    async getServiceVariables(incluirInactivos = false): Promise<ServiceVariable[]> {
        if (!supabase) return [];
        let q = supabase.from('service_variables').select('*').order('sort_order');
        if (!incluirInactivos) q = q.or('active.is.null,active.eq.true');
        const { data, error } = await q;
        if (error) {
            console.error('Error fetching variables:', error);
            return [];
        }
        return (data || []).map(mapServiceVariable);
    },

    async upsertService(s: Partial<Service> & { id?: string }) {
        if (!supabase) throw new Error("Supabase not configured");
        const fila: Record<string, any> = {
            name: s.name, category: s.category ?? null, description: s.description ?? null,
            base_price: s.basePrice ?? null, cost: s.cost ?? null, units: s.units ?? null,
            sku: s.sku || null, active: s.active ?? true, notes: s.notes ?? null,
            price_updated_at: new Date().toISOString().slice(0, 10),
        };
        if (s.id) fila.id = s.id;
        const { data, error } = await supabase.from('services')
            .upsert([fila]).select().single();
        if (error) throw error;
        return mapService(data);
    },

    async upsertServiceVariable(v: Partial<ServiceVariable> & { serviceId: string }) {
        if (!supabase) throw new Error("Supabase not configured");
        const fila: Record<string, any> = {
            service_id: v.serviceId, name: v.name, kind: v.kind || 'sustitucion',
            price: v.price ?? null, cost: v.cost ?? null, units: v.units ?? null,
            active: v.active ?? true, sort_order: v.sortOrder ?? 0,
        };
        if (v.id) fila.id = v.id;
        const { data, error } = await supabase.from('service_variables')
            .upsert([fila]).select().single();
        if (error) throw error;
        return mapServiceVariable(data);
    },

    /** Ajustes del negocio (IVA, moneda). Con default si falta la migración. */
    async getAjustes(): Promise<Record<string, any>> {
        if (!supabase) return {};
        const { data, error } = await supabase.from('ajustes').select('clave,valor');
        if (error) {
            console.warn('tabla ajustes no disponible, usando defaults:', error.message);
            return {};
        }
        return Object.fromEntries((data || []).map((r: any) => [r.clave, r.valor]));
    },

    // AUTH
    auth: {
        async login(email: string, password: string) {
            if (!supabase) {
                console.warn("Supabase not configured. Using mock login.");
                return {
                    id: 'mock-user-1',
                    email: email,
                    fullName: email.split('@')[0] || 'Mock User',
                    role: 'Super User',
                    avatarUrl: 'https://i.pravatar.cc/150?u=' + encodeURIComponent(email)
                } as User;
            }

            // For prototype: Simple query. In prod use supabase.auth.
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('email', email)
                .single();

            if (error) throw new Error("User not found");
            if (data.password !== password) throw new Error("Invalid password");

            return {
                id: data.id,
                email: data.email,
                fullName: data.full_name,
                role: data.role,
                avatarUrl: data.avatar_url,
                createdAt: data.created_at
            } as User;
        },

        async getUsers() {
            if (!supabase) return [];
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .order('full_name');

            if (error) throw error;
            return (data || []).map((u: any) => ({
                id: u.id,
                email: u.email,
                fullName: u.full_name,
                role: u.role,
                avatarUrl: u.avatar_url,
                createdAt: u.created_at
            }));
        },

        async createUser(user: any) {
            if (!supabase) throw new Error("Supabase not configured");
            const { data, error } = await supabase
                .from('users')
                .insert([{
                    email: user.email,
                    password: user.password,
                    full_name: user.fullName,
                    role: user.role, // 'Super User' | 'Level 2'
                    avatar_url: user.avatarUrl
                }])
                .select()
                .single();

            if (error) throw error;
            return data;
        },

        async updateUser(id: string, updates: any) {
            if (!supabase) throw new Error("Supabase not configured");
            const dbUpdates: any = {};
            if (updates.email) dbUpdates.email = updates.email;
            if (updates.password) dbUpdates.password = updates.password;
            if (updates.fullName) dbUpdates.full_name = updates.fullName;
            if (updates.role) dbUpdates.role = updates.role;
            if (updates.avatarUrl !== undefined) dbUpdates.avatar_url = updates.avatarUrl;

            const { error } = await supabase
                .from('users')
                .update(dbUpdates)
                .eq('id', id);

            if (error) throw error;
        },

        async deleteUser(id: string) {
            if (!supabase) throw new Error("Supabase not configured");
            const { error } = await supabase
                .from('users')
                .delete()
                .eq('id', id);

            if (error) throw error;
        }
    },

    // INVOICING (CFDI 4.0)
    async getInvoices() {
        if (!supabase) return [];
        const { data, error } = await supabase
            .from('invoices')
            .select('*, items:invoice_items(*)')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching invoices:', error);
            return [];
        }

        return (data || []).map((inv: any) => ({
            id: inv.id,
            series: inv.series,
            folio: inv.folio,
            date: inv.date,
            clientId: inv.client_id,
            clientName: inv.client_name,
            clientRfc: inv.client_rfc,
            clientFiscalRegime: inv.client_fiscal_regime,
            clientPostalCode: inv.client_postal_code,
            clientUseCFDI: inv.client_use_cfdi,
            paymentForm: inv.payment_form,
            paymentMethod: inv.payment_method,
            currency: inv.currency,
            exchangeRate: inv.exchange_rate,
            placeOfIssue: inv.place_of_issue,
            exportation: inv.exportation,
            subtotal: inv.subtotal,
            discount: inv.discount,
            totalTaxesTransferred: inv.total_taxes_transferred,
            totalTaxesRetained: inv.total_taxes_retained,
            total: inv.total,
            status: inv.status,
            uuid: inv.uuid,
            items: (inv.items || []).map((item: any) => ({
                id: item.id,
                productCode: item.product_code,
                unitCode: item.unit_code,
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unit_price,
                discount: item.discount,
                taxObject: item.tax_object,
                amount: item.amount,
                taxes: item.taxes // JSONB
            }))
        }));
    },

    async createInvoice(invoice: any) {
        if (!supabase) throw new Error("Supabase not configured");

        const { data: invoiceData, error: invoiceError } = await supabase
            .from('invoices')
            .insert([{
                series: invoice.series,
                folio: invoice.folio,
                date: invoice.date,
                client_id: invoice.clientId,
                client_name: invoice.clientName,
                client_rfc: invoice.clientRfc,
                client_fiscal_regime: invoice.clientFiscalRegime,
                client_postal_code: invoice.clientPostalCode,
                client_use_cfdi: invoice.clientUseCFDI,
                payment_form: invoice.paymentForm,
                payment_method: invoice.paymentMethod,
                currency: invoice.currency,
                exchange_rate: invoice.exchangeRate,
                place_of_issue: invoice.placeOfIssue,
                exportation: invoice.exportation,
                subtotal: invoice.subtotal,
                discount: invoice.discount,
                total_taxes_transferred: invoice.totalTaxesTransferred,
                total_taxes_retained: invoice.totalTaxesRetained,
                total: invoice.total,
                status: invoice.status,
                // El UUID llegaba desde Invoicing.tsx y se tiraba aquí: toda
                // factura timbrada quedaba guardada sin folio fiscal, y sin él
                // no hay cómo ligarle su REP ni encontrarla ante una aclaración.
                uuid: invoice.uuid || null
            }])
            .select()
            .single();

        if (invoiceError) throw invoiceError;

        if (invoice.items && invoice.items.length > 0) {
            const itemsToInsert = invoice.items.map((item: any) => ({
                invoice_id: invoiceData.id,
                product_code: item.productCode,
                unit_code: item.unitCode,
                description: item.description,
                quantity: item.quantity,
                unit_price: item.unitPrice,
                discount: item.discount,
                tax_object: item.taxObject,
                amount: item.amount,
                taxes: item.taxes // JSONB
            }));

            const { error: itemsError } = await supabase
                .from('invoice_items')
                .insert(itemsToInsert);

            if (itemsError) throw itemsError;
        }

        return invoiceData;
    },

    async updateInvoiceStatus(id: string, status: string, uuid?: string) {
        if (!supabase) throw new Error("Supabase not configured");
        const updates: any = { status };
        if (uuid) updates.uuid = uuid;

        const { error } = await supabase
            .from('invoices')
            .update(updates)
            .eq('id', id);

        if (error) throw error;
    },

    // FORGE — diseños paramétricos (mono-forge) + visor AR
    async getForgeModels() {
        if (!supabase) {
            console.warn("Supabase not configured. Return empty array.");
            return [];
        }
        const { data, error } = await supabase
            .from('forge_models')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(mapForgeModel);
    },

    async getForgeModel(id: string) {
        if (!supabase) throw new Error("Supabase not configured");
        const { data, error } = await supabase
            .from('forge_models')
            .select('*')
            .eq('id', id)
            .single();
        if (error) throw error;
        return mapForgeModel(data);
    },

    async createForgeModel(model: { name: string; description?: string; projectId?: string | null; projectJson: any }) {
        if (!supabase) throw new Error("Supabase not configured");
        const { data, error } = await supabase
            .from('forge_models')
            .insert([{
                name: model.name,
                description: model.description || null,
                project_id: model.projectId || null,
                project_json: model.projectJson,
                status: 'draft'
            }])
            .select()
            .single();
        if (error) throw error;
        return mapForgeModel(data);
    },

    async updateForgeModel(id: string, updates: Partial<ForgeModel>) {
        if (!supabase) throw new Error("Supabase not configured");
        const dbUpdates: any = {};
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.description !== undefined) dbUpdates.description = updates.description;
        if (updates.projectJson !== undefined) dbUpdates.project_json = updates.projectJson;
        if (updates.glbUrl !== undefined) dbUpdates.glb_url = updates.glbUrl;
        if (updates.usdzUrl !== undefined) dbUpdates.usdz_url = updates.usdzUrl;
        if (updates.status !== undefined) dbUpdates.status = updates.status;

        const { error } = await supabase
            .from('forge_models')
            .update(dbUpdates)
            .eq('id', id);
        if (error) throw error;
    },

    async deleteForgeModel(id: string) {
        if (!supabase) throw new Error("Supabase not configured");
        const { error } = await supabase
            .from('forge_models')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },

    // FORGE JOBS — la cola que atiende el Forge Agent en tu máquina
    async getForgeJobs(limit = 15) {
        if (!supabase) return [];
        const { data, error } = await supabase
            .from('forge_jobs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);
        if (error) throw error;
        return (data || []).map(mapForgeJob);
    },

    async createForgeJob(prompt: string, base?: { modelId: string; projectJson: any },
                         imagenes: string[] = []) {
        if (!supabase) throw new Error("Supabase not configured");
        const fila: Record<string, any> = {
            prompt,
            base_model_id: base?.modelId || null,
            base_project_json: base?.projectJson || null,
            status: 'pending'
        };
        if (imagenes.length) fila.imagenes = imagenes;

        let { data, error } = await supabase
            .from('forge_jobs').insert([fila]).select().single();

        // Si falta la migración de imágenes, PostgREST devuelve 42703. Encolar
        // sin referencias es infinitamente mejor que no encolar: el diseño se
        // hace igual y el aviso dice qué migración corrió falta.
        if (error && (error.code === '42703' || /imagenes/i.test(error.message))) {
            delete fila.imagenes;
            ({ data, error } = await supabase
                .from('forge_jobs').insert([fila]).select().single());
            if (!error) {
                console.warn('forge_jobs.imagenes no existe: se encoló sin las '
                    + 'referencias. Corre supabase/migrations/20260807_forge_job_imagenes.sql');
            }
        }
        if (error) throw error;
        return mapForgeJob(data);
    },

    async deleteForgeJob(id: string) {
        if (!supabase) throw new Error("Supabase not configured");
        const { error } = await supabase.from('forge_jobs').delete().eq('id', id);
        if (error) throw error;
    },

    /** Sube una imagen de referencia del prompt y devuelve su URL pública. */
    async subirImagenReferencia(file: File) {
        if (!supabase) throw new Error("Supabase not configured");
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `refs/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage
            .from('forge')
            .upload(path, file, { upsert: false, contentType: file.type || 'image/jpeg' });
        if (error) throw error;
        return supabase.storage.from('forge').getPublicUrl(path).data.publicUrl;
    },

    /** Sube un asset (GLB/USDZ/JSON) al bucket público 'forge' y devuelve su URL pública. */
    async uploadForgeAsset(modelId: string, filename: string, blob: Blob, contentType: string) {
        if (!supabase) throw new Error("Supabase not configured");
        const path = `${modelId}/${filename}`;
        const { error } = await supabase.storage
            .from('forge')
            .upload(path, blob, { upsert: true, contentType });
        if (error) throw error;
        const { data } = supabase.storage.from('forge').getPublicUrl(path);
        return data.publicUrl;
    },

    /**
     * URL temporal para el reporte interno de costos.
     *
     * Vive en un bucket PRIVADO porque lleva el margen y el costo directo: no
     * tiene URL pública, hay que firmarla cada vez y la firma caduca. Nunca
     * guardes el resultado en la base ni lo mandes por correo.
     */
    async firmarCostosInternos(costosPath: string, segundos = 300) {
        if (!supabase) throw new Error("Supabase not configured");
        const { data, error } = await supabase.storage
            .from('forge-interno')
            .createSignedUrl(costosPath, segundos);
        if (error) throw error;
        return data.signedUrl;
    },

    // ── REP: facturas externas y libro de pagos ─────────────────────────
    // Migración: supabase/migrations/20260817_rep_facturas_externas.sql

    /** Facturas PPD timbradas con otro PAC, registradas para poder emitir su REP. */
    async getFacturasExternas(): Promise<FacturaExterna[]> {
        if (!supabase) return [];
        const { data, error } = await supabase
            .from('facturas_externas')
            .select('*')
            .order('fecha', { ascending: false });
        if (error) {
            console.error('Error al leer facturas externas:', error);
            return [];
        }
        return (data || []).map(mapFacturaExterna);
    },

    /**
     * Registra una factura externa a partir de su XML ya leído.
     *
     * El UUID es único en la tabla: reimportar la misma factura actualiza el
     * registro en vez de duplicarlo, porque dos filas con el mismo UUID
     * llevarían a timbrar dos veces la misma parcialidad.
     */
    async guardarFacturaExterna(f: CfdiExterno, xml?: string): Promise<FacturaExterna> {
        if (!supabase) throw new Error("Supabase not configured");
        const { data, error } = await supabase
            .from('facturas_externas')
            .upsert([{
                uuid: f.uuid,
                serie: f.serie || null,
                folio: f.folio || null,
                fecha: f.fecha,
                emisor_rfc: f.emisorRfc,
                emisor_nombre: f.emisorNombre,
                receptor_rfc: f.receptorRfc,
                receptor_nombre: f.receptorNombre,
                receptor_regimen: f.receptorRegimen,
                receptor_cp: f.receptorCp,
                uso_cfdi: f.usoCfdi,
                moneda: f.moneda,
                tipo_cambio: f.tipoCambio,
                metodo_pago: f.metodoPago,
                forma_pago: f.formaPago,
                subtotal: f.subtotal,
                total: f.total,
                impuestos: f.impuestos,
                xml: xml ?? null,
            }], { onConflict: 'uuid' })
            .select()
            .single();
        if (error) throw error;
        return mapFacturaExterna(data);
    },

    async eliminarFacturaExterna(id: string) {
        if (!supabase) throw new Error("Supabase not configured");
        const { error } = await supabase.from('facturas_externas').delete().eq('id', id);
        if (error) throw error;
    },

    /** Pagos ya reportados en un REP, de todas las facturas o de una sola. */
    async getRepPagos(facturaUuid?: string): Promise<RepPago[]> {
        if (!supabase) return [];
        let q = supabase.from('rep_pagos').select('*');
        if (facturaUuid) q = q.eq('factura_uuid', facturaUuid);
        const { data, error } = await q.order('parcialidad', { ascending: true });
        if (error) {
            console.error('Error al leer el libro de pagos:', error);
            return [];
        }
        return (data || []).map(mapRepPago);
    },

    /**
     * Asienta un REP ya timbrado.
     *
     * De aquí salen la parcialidad y el saldo anterior del pago siguiente: sin
     * este registro, en la parcialidad 2 el saldo se vuelve a escribir a mano y
     * un saldo mal puesto invalida el complemento ante el SAT.
     */
    async registrarRepPago(p: Omit<RepPago, 'id'>): Promise<void> {
        if (!supabase) throw new Error("Supabase not configured");
        const { error } = await supabase.from('rep_pagos').insert([{
            factura_uuid: p.facturaUuid,
            factura_origen: p.facturaOrigen,
            factura_folio: p.facturaFolio || null,
            rep_uuid: p.repUuid || null,
            rep_facturapi_id: p.repFacturapiId || null,
            rep_serie: p.repSerie || null,
            rep_folio: p.repFolio ?? null,
            fecha_pago: p.fechaPago,
            forma_pago: p.formaPago,
            moneda: p.moneda,
            tipo_cambio: p.tipoCambio,
            monto: p.monto,
            parcialidad: p.parcialidad,
            saldo_anterior: p.saldoAnterior,
            saldo_insoluto: p.saldoInsoluto,
        }]);
        if (error) throw error;
    }
};
